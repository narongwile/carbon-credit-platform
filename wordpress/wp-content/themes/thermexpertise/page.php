<?php
/**
 * Single page template (About, Services, etc.).
 *
 * @package ThermExpertise
 */

get_header();

while ( have_posts() ) :
	the_post();
	?>
	<article <?php post_class( 'page' ); ?>>
		<header class="page__hero">
			<div class="container">
				<h1 class="page__title"><?php the_title(); ?></h1>
			</div>
		</header>
		<div class="container page__body entry-content">
			<?php
			the_content();
			wp_link_pages();
			?>
		</div>
	</article>
	<?php
endwhile;

get_footer();
