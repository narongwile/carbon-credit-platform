<?php
/**
 * Fallback index / blog listing template.
 *
 * @package ThermExpertise
 */

get_header();
?>

<section class="section">
	<div class="container">
		<?php if ( have_posts() ) : ?>
			<header class="section__head">
				<h1 class="section__title">
					<?php
					if ( is_home() && ! is_front_page() ) {
						single_post_title();
					} else {
						esc_html_e( 'Latest', 'thermexpertise' );
					}
					?>
				</h1>
			</header>

			<div class="card-grid">
				<?php
				while ( have_posts() ) :
					the_post();
					?>
					<article <?php post_class( 'card' ); ?>>
						<?php if ( has_post_thumbnail() ) : ?>
							<a class="card__media" href="<?php the_permalink(); ?>"><?php the_post_thumbnail( 'medium_large' ); ?></a>
						<?php endif; ?>
						<h2 class="card__title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
						<div class="card__desc"><?php the_excerpt(); ?></div>
					</article>
					<?php
				endwhile;
				?>
			</div>

			<div class="pagination">
				<?php the_posts_pagination( array( 'mid_size' => 2 ) ); ?>
			</div>

		<?php else : ?>
			<p><?php esc_html_e( 'Nothing here yet.', 'thermexpertise' ); ?></p>
		<?php endif; ?>
	</div>
</section>

<?php
get_footer();
