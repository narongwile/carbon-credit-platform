<?php
/**
 * Single post template.
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
				<p class="page__meta"><?php echo esc_html( get_the_date() ); ?></p>
			</div>
		</header>
		<?php if ( has_post_thumbnail() ) : ?>
			<div class="container"><?php the_post_thumbnail( 'large' ); ?></div>
		<?php endif; ?>
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
