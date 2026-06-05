<?php
/**
 * Generic page template (fallback for pages without a slug-specific template).
 *
 * @package thermexpertise
 */

get_header();

while ( have_posts() ) :
	the_post();
	?>
	<section class="page-hero">
		<div class="container">
			<div class="breadcrumb"><a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Home', 'thermexpertise' ); ?></a> &nbsp;/&nbsp; <?php the_title(); ?></div>
			<h1><?php the_title(); ?></h1>
		</div>
	</section>

	<section class="section">
		<div class="container">
			<article class="entry">
				<?php
				if ( has_post_thumbnail() ) {
					the_post_thumbnail( 'large' );
				}
				the_content();
				wp_link_pages();
				?>
			</article>
		</div>
	</section>
	<?php
endwhile;

get_footer();
